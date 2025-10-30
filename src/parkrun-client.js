const Parkrun = require('parkrun.js');
const logger = require('./logger');

class ParkrunClient {
  constructor() {
    this.client = null;
    this.user = null;
    this.authenticated = false;
    this.lastSync = null;
    this.cachedProfile = null;
    this.cachedResults = null;
  }

  async initialize() {
    try {
      logger.info('Initializing Parkrun client...');
      
      const username = process.env.PARKRUN_USERNAME;
      const password = process.env.PARKRUN_PASSWORD;
      
      if (!username || !password) {
        throw new Error('Parkrun credentials not configured. Check PARKRUN_USERNAME and PARKRUN_PASSWORD environment variables.');
      }

      // Force re-authentication to get fresh token
      logger.info('Authenticating with Parkrun.org...');
      this.client = await Parkrun.authSync(username, password);
      
      if (!this.client) {
        throw new Error('Failed to authenticate with Parkrun - no client returned');
      }
      
      logger.info('Parkrun authentication successful');
      this.authenticated = true;
      
      // Try to get user profile (may fail due to parkrun.js validation issues)
      try {
        this.user = await this.client.getMe();
        logger.info(`Successfully authenticated parkrun user: ${this.user.firstName} ${this.user.lastName}`);
      } catch (error) {
        logger.warn('Could not fetch user profile due to parkrun.js validation issue, but authentication succeeded', error.message);
        // Create fallback user object with the athlete ID
        this.user = { 
          firstName: 'Gavin', 
          lastName: 'Slater', 
          id: username,
          athleteId: username,
          // Add minimal required fields to avoid validation errors
          email: 'gavin@slaters.uk.com'
        };
      }
      
      // Cache initial profile data
      await this.refreshProfile();
      
      return this.user;
    } catch (error) {
      logger.error('Failed to initialize Parkrun client', error);
      this.authenticated = false;
      throw error;
    }
  }

  isAuthenticated() {
    return this.authenticated && this.user !== null;
  }

  async refreshProfile() {
    if (!this.isAuthenticated()) {
      throw new Error('Parkrun client not authenticated');
    }

    try {
      // Get user profile data
      this.cachedProfile = {
        id: this.user.id,
        firstName: this.user.firstName,
        lastName: this.user.lastName,
        clubName: this.user.club?.shortName || null,
        homeRun: this.user.homeRun?.name || null,
        totalRuns: this.user.runs || 0,
        totalVolunteers: this.user.volunteers || 0,
        joinDate: this.user.joinDate,
        lastUpdated: new Date().toISOString()
      };

      logger.info(`Refreshed profile for ${this.cachedProfile.firstName} ${this.cachedProfile.lastName}`);
      return this.cachedProfile;
    } catch (error) {
      logger.error('Failed to refresh profile', error);
      throw error;
    }
  }

  async getProfile() {
    if (!this.cachedProfile || this.isProfileStale()) {
      await this.refreshProfile();
    }
    return this.cachedProfile;
  }

  async getResults(limit = 50, offset = 0) {
    if (!this.isAuthenticated()) {
      throw new Error('Parkrun client not authenticated');
    }

    try {
      logger.info(`Fetching parkrun results (limit: ${limit}, offset: ${offset})`);
      
      let allRuns = [];
      
      try {
        // Approach 1: Use direct API call to get runs (since this.user might be a fallback object)
        logger.info('Using direct API call to get actual parkrun results');
        const athleteId = this.cachedProfile?.id || '1366335';
        
        let runResults;
        try {
          runResults = await this.client._multiGet(
            "/v1/results",
            {
              params: { athleteId: athleteId }
            },
            "Results",
            "ResultsRange"
          );
        } catch (apiError) {
          if (apiError.message && apiError.message.includes('401')) {
            logger.warn('API returned 401 Unauthorized, attempting re-authentication...');
            await this.initialize(); // Re-authenticate
            // Retry the API call once
            runResults = await this.client._multiGet(
              "/v1/results",
              {
                params: { athleteId: athleteId }
              },
              "Results",
              "ResultsRange"
            );
          } else {
            throw apiError;
          }
        }
        logger.info(`Retrieved ${runResults.length} actual parkrun results`);
        
        // Log first result for debugging
        if (runResults.length > 0) {
          logger.info('Sample raw result keys:', Object.keys(runResults[0]));
          logger.info('Sample EventDate value:', runResults[0].EventDate);
        }
        
        // Process raw data directly without RunResult class first
        allRuns = runResults.map(runData => {
          return {
            runDate: runData.EventDate ? new Date(runData.EventDate).toISOString().split('T')[0] : null,
            eventName: runData.EventLongName || 'Unknown Event',
            eventId: runData.EventNumber || null,
            finishTime: runData.RunTime || null,
            position: runData.FinishPosition || null,
            ageGrade: runData.AgeGrading ? Math.round(parseFloat(runData.AgeGrading)) : null,
            isPersonalBest: runData.WasPbRun === "1" || runData.WasPbRun === true,
            totalRunners: null, // Not available in raw data
            ageCategory: runData.AgeCategory || null,
            genderPosition: runData.GenderPosition || null,
            runNumber: runData.RunId || null,
            athleteId: runData.AthleteID || null,
            wasFirstTimer: runData.FirstTimer === "1" || runData.FirstTimer === true,
            wasGenuinePB: runData.GenuinePB === "1" || runData.GenuinePB === true
          };
        });
        
        logger.info(`Processed ${allRuns.length} actual parkrun results with dates and times`);
        
      } catch (runsError) {
        logger.error('getRuns() approach failed with error:', runsError.message, runsError.stack);
        
        try {
          // Fallback: Use client.getAthleteParkruns to get events the athlete has run
          const athleteId = this.cachedProfile?.id || '1366335';
          const athleteParkruns = await this.client.getAthleteParkruns(athleteId);
          logger.info(`Retrieved ${athleteParkruns.length} events from getAthleteParkruns as fallback`);
          
          // This gives us events, but not the detailed results
          allRuns = athleteParkruns.map(event => ({
            eventName: event.getName(),
            eventLocation: event.getLocation(),
            eventId: event.getID(),
            runDate: null,
            finishTime: null,
            position: null,
            ageGrade: null,
            isPersonalBest: false,
            totalRunners: null
          }));
        } catch (fallbackError) {
          logger.error('All approaches failed', fallbackError.message);
          allRuns = [];
        }
      }
      
      // Apply pagination
      const runResults = allRuns.slice(offset, offset + limit);

      // Cache results if this is the first page
      if (offset === 0) {
        this.cachedResults = runResults;
      }

      logger.info(`Retrieved ${runResults.length} parkrun results`);
      return runResults;
    } catch (error) {
      logger.error('Failed to fetch parkrun results', error);
      throw error;
    }
  }

  async getStatistics() {
    if (!this.isAuthenticated()) {
      throw new Error('Parkrun client not authenticated');
    }

    try {
      const profile = await this.getProfile();
      const recentResults = await this.getResults(20, 0);
      
      if (recentResults.length === 0) {
        return {
          totalRuns: profile.totalRuns,
          totalVolunteers: profile.totalVolunteers,
          message: 'No recent results available for statistics'
        };
      }

      // Calculate statistics
      const validTimes = recentResults
        .filter(result => result.finishTime && result.finishTime !== 'Unknown')
        .map(result => this.parseTimeToSeconds(result.finishTime));

      const personalBests = recentResults.filter(result => result.isPersonalBest);
      
      const stats = {
        profile: {
          name: `${profile.firstName} ${profile.lastName}`,
          club: profile.clubName,
          homeRun: profile.homeRun,
          totalRuns: profile.totalRuns,
          totalVolunteers: profile.totalVolunteers
        },
        performance: {
          recentRuns: recentResults.length,
          personalBestsInPeriod: personalBests.length,
          averageTime: validTimes.length > 0 ? this.formatSecondsToTime(
            validTimes.reduce((a, b) => a + b, 0) / validTimes.length
          ) : null,
          fastestTime: validTimes.length > 0 ? this.formatSecondsToTime(Math.min(...validTimes)) : null,
          averagePosition: recentResults.length > 0 ? Math.round(
            recentResults.reduce((sum, result) => sum + (result.position || 0), 0) / recentResults.length
          ) : null,
          averageAgeGrade: recentResults.length > 0 ? Math.round(
            recentResults.reduce((sum, result) => sum + (result.ageGrade || 0), 0) / recentResults.length
          ) : null
        },
        venues: this.getVenueStatistics(recentResults),
        lastUpdated: new Date().toISOString()
      };

      return stats;
    } catch (error) {
      logger.error('Failed to calculate parkrun statistics', error);
      throw error;
    }
  }

  async getRecentSummary(days = 30) {
    if (!this.isAuthenticated()) {
      return { error: 'Not authenticated' };
    }

    try {
      const recentResults = await this.getResults(50, 0);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const periodResults = recentResults.filter(result => 
        new Date(result.runDate) >= cutoffDate
      );

      return {
        period: `${days} days`,
        runsCompleted: periodResults.length,
        personalBests: periodResults.filter(r => r.isPersonalBest).length,
        averageTime: this.calculateAverageTime(periodResults),
        venues: [...new Set(periodResults.map(r => r.eventName))],
        lastRun: periodResults.length > 0 ? periodResults[0] : null
      };
    } catch (error) {
      logger.error('Failed to get recent summary', error);
      return { error: error.message };
    }
  }

  async syncData() {
    if (!this.isAuthenticated()) {
      throw new Error('Parkrun client not authenticated');
    }

    try {
      logger.info('Starting parkrun data sync...');
      
      await this.refreshProfile();
      const results = await this.getResults(100, 0); // Get more comprehensive data
      const stats = await this.getStatistics();
      
      this.lastSync = new Date().toISOString();
      
      logger.info(`Parkrun data sync completed. Retrieved ${results.length} results`);
      
      return {
        syncTime: this.lastSync,
        profileUpdated: true,
        resultsCount: results.length,
        statistics: stats
      };
    } catch (error) {
      logger.error('Failed to sync parkrun data', error);
      throw error;
    }
  }

  // Utility methods
  parseTimeToSeconds(timeString) {
    if (!timeString || timeString === 'Unknown') return null;
    
    const parts = timeString.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return null;
  }

  formatSecondsToTime(seconds) {
    if (!seconds) return null;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  calculateAverageTime(results) {
    const validTimes = results
      .filter(result => result.finishTime && result.finishTime !== 'Unknown')
      .map(result => this.parseTimeToSeconds(result.finishTime))
      .filter(time => time !== null);
    
    if (validTimes.length === 0) return null;
    
    const avgSeconds = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
    return this.formatSecondsToTime(avgSeconds);
  }

  getVenueStatistics(results) {
    const venues = {};
    
    results.forEach(result => {
      const venue = result.eventName;
      if (venue && venue !== 'Unknown') {
        if (!venues[venue]) {
          venues[venue] = { count: 0, times: [] };
        }
        venues[venue].count++;
        
        const timeInSeconds = this.parseTimeToSeconds(result.finishTime);
        if (timeInSeconds) {
          venues[venue].times.push(timeInSeconds);
        }
      }
    });

    // Calculate average time per venue
    Object.keys(venues).forEach(venue => {
      const times = venues[venue].times;
      if (times.length > 0) {
        venues[venue].averageTime = this.formatSecondsToTime(
          times.reduce((a, b) => a + b, 0) / times.length
        );
      }
    });

    return venues;
  }

  isProfileStale() {
    if (!this.cachedProfile || !this.cachedProfile.lastUpdated) return true;
    
    const lastUpdate = new Date(this.cachedProfile.lastUpdated);
    const staleThreshold = new Date();
    staleThreshold.setHours(staleThreshold.getHours() - 6); // 6 hours
    
    return lastUpdate < staleThreshold;
  }
}

module.exports = ParkrunClient;