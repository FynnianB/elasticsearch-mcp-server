#!/usr/bin/env node

import { ConfigManager } from './config/configManager.js';
import type { TeamConfig, MultiTeamConfig } from './types.js';
import { ElasticsearchService } from './services/elasticsearchService.js';
import * as readline from 'readline';

class ElasticsearchMCPCLI {
  private configManager: ConfigManager;
  private elasticsearchService: ElasticsearchService;

  constructor() {
    this.configManager = new ConfigManager();
    this.elasticsearchService = new ElasticsearchService(this.configManager);
  }

  async run(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
      switch (command) {
        case 'generate-config':
          await this.generateConfig(args[1]);
          break;
        case 'validate-config':
          await this.validateConfig(args[1]);
          break;
        case 'list-teams':
          await this.listTeams();
          break;
        case 'test-team':
          await this.testTeam(args[1]);
          break;
        case 'add-team':
          await this.addTeamInteractive();
          break;
        case 'remove-team':
          await this.removeTeam(args[1]);
          break;
        default:
          this.showHelp();
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  private async addTeamInteractive(): Promise<void> {
    console.log('\n🎯 Add New Team');
    console.log('================');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (text: string): Promise<string> => {
      return new Promise(resolve => {
        rl.question(text, resolve);
      });
    };

    try {
      const teamId = await question("Team ID (e.g., 'frontend', 'backend', 'data'): ");
      if (!teamId.trim()) {
        throw new Error('Team ID is required');
      }

      const existingTeams = this.configManager.getAllTeams();
      if (existingTeams.includes(teamId)) {
        throw new Error(`Team '${teamId}' already exists`);
      }

      const teamName = await question("Team Name (e.g., 'Frontend Team'): ");
      if (!teamName.trim()) {
        throw new Error('Team Name is required');
      }

      // Index patterns
      console.log('\n📄 Index Patterns');
      console.log('==================');

      const exceptionPatterns = await question(
        'Exception index patterns (comma-separated) [logs-*]: '
      );
      const applicationPatterns = await question(
        'Application index patterns (comma-separated) [apm-*]: '
      );

      const indexPatterns = {
        exceptions: exceptionPatterns.trim()
          ? exceptionPatterns.split(',').map(p => p.trim())
          : ['logs-*'],
        applications: applicationPatterns.trim()
          ? applicationPatterns.split(',').map(p => p.trim())
          : ['apm-*'],
      };

      // Dynamic environments setup
      console.log('\n🌍 Environment Configuration');
      console.log('============================');

      const environments: any = {};
      const environmentsToAdd: string[] = [];

      // Add environments dynamically
      console.log(
        "You can define custom environments (e.g., 'dev', 'staging', 'prod', 'testing', etc.)"
      );

      let addingEnvironments = true;
      while (addingEnvironments) {
        const envName = await question(`\nEnvironment name (or 'done' to finish): `);

        if (envName.toLowerCase() === 'done') {
          addingEnvironments = false;
          break;
        }

        if (!envName.trim()) {
          console.log("Environment name cannot be empty. Use 'done' to finish.");
          continue;
        }

        if (environmentsToAdd.includes(envName.trim())) {
          console.log(`Environment '${envName.trim()}' already added.`);
          continue;
        }

        environmentsToAdd.push(envName.trim());
        console.log(`✓ Environment '${envName.trim()}' added to list`);
      }

      if (environmentsToAdd.length === 0) {
        console.log("Adding default 'production' environment...");
        environmentsToAdd.push('production');
      }

      // Configure each environment
      for (const env of environmentsToAdd) {
        console.log(`\n--- ${env.toUpperCase()} Environment ---`);
        const envConfig = await this.configureEnvironment(env, question);
        environments[env] = envConfig;
      }

      // Select default environment
      console.log(`\nAvailable environments: ${environmentsToAdd.join(', ')}`);
      const defaultEnvironment = await question(`Default environment [${environmentsToAdd[0]}]: `);
      const defaultEnv = defaultEnvironment.trim() || environmentsToAdd[0];

      if (defaultEnv && !environmentsToAdd.includes(defaultEnv)) {
        throw new Error(
          `Default environment '${defaultEnv}' must be one of the configured environments: ${environmentsToAdd.join(
            ', '
          )}`
        );
      }

      const teamConfig: TeamConfig = {
        teamId,
        teamName,
        defaultEnvironment: defaultEnv || environmentsToAdd[0],
        environments,
        indexPatterns,
      };

      // Test connection for default environment
      console.log(`\n🔌 Testing connection to ${defaultEnv} environment...`);
      try {
        const isConnected = await this.elasticsearchService.testConnection(teamId, defaultEnv);

        if (isConnected) {
          console.log(`✅ Connection to ${defaultEnv} successful!`);
        } else {
          console.log(`⚠️  Connection to ${defaultEnv} failed, but team will be added anyway`);
        }
      } catch (error) {
        console.log(
          `⚠️  Could not test connection: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      this.configManager.addTeam(teamConfig);
      console.log(`\n✅ Team '${teamName}' (${teamId}) added successfully!`);

      console.log(`\n🌐 Usage Examples:`);
      console.log(`   MCP URL: http://localhost:3000/elasticsearch?TEAM=${teamId}`);
      console.log(`   CLI test: npm run cli -- test-team ${teamId}`);
      console.log(`\n📋 Configured environments: ${environmentsToAdd.join(', ')}`);
      console.log(`🎯 Default environment: ${defaultEnv}`);
    } finally {
      rl.close();
    }
  }

  private async configureEnvironment(
    env: string,
    question: (text: string) => Promise<string>
  ): Promise<any> {
    const node = await question(`Elasticsearch node URL: `);
    if (!node.trim()) {
      throw new Error('Elasticsearch node URL is required');
    }

    const authMethod = await question('Authentication method (none/basic/apikey/cloud) [none]: ');
    const auth = authMethod.trim().toLowerCase() || 'none';

    const envConfig: any = { node: node.trim() };

    switch (auth) {
      case 'basic':
        const username = await question('Username: ');
        const password = await question('Password: ');
        if (username.trim() && password.trim()) {
          envConfig.username = username.trim();
          envConfig.password = password.trim();
        }
        break;

      case 'apikey':
        const apiKey = await question('API Key: ');
        if (apiKey.trim()) {
          envConfig.apiKey = apiKey.trim();
        }
        break;

      case 'cloud':
        const cloudId = await question('Cloud ID: ');
        const cloudUsername = await question('Username: ');
        const cloudPassword = await question('Password: ');
        if (cloudId.trim() && cloudUsername.trim() && cloudPassword.trim()) {
          envConfig.cloud = { id: cloudId.trim() };
          envConfig.username = cloudUsername.trim();
          envConfig.password = cloudPassword.trim();
        }
        break;

      case 'none':
      default:
        break;
    }

    return envConfig;
  }

  private async removeTeam(teamId?: string): Promise<void> {
    if (!teamId) {
      console.error('❌ Please specify a team ID');
      console.log('Usage: npm run cli -- remove-team <team-id>');
      return;
    }

    const teams = this.configManager.getAllTeams();
    if (!teams.includes(teamId)) {
      console.error(`❌ Team '${teamId}' not found`);
      console.log(`Available teams: ${teams.join(', ')}`);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (text: string): Promise<string> => {
      return new Promise(resolve => {
        rl.question(text, resolve);
      });
    };

    try {
      const teamConfig = this.configManager.getTeamConfig(teamId);
      console.log(`\n⚠️  About to remove team: ${teamConfig.teamName} (${teamId})`);
      const confirm = await question('Are you sure? (y/N): ');

      if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
        this.configManager.removeTeam(teamId);
        console.log(`✅ Team '${teamId}' removed successfully`);
      } else {
        console.log('❌ Removal cancelled');
      }
    } finally {
      rl.close();
    }
  }

  private async generateConfig(configPath?: string): Promise<void> {
    const outputPath = configPath || './teams-config.json';

    const emptyConfig: MultiTeamConfig = {
      server: {
        name: 'elasticsearch-mcp',
        version: '1.0.0',
      },
      teams: {},
    };

    this.configManager.saveConfig(emptyConfig, outputPath);
    console.log(`✅ Empty teams configuration generated: ${outputPath}`);
    console.log(`\n🎯 Next steps:`);
    console.log(`   1. Add a team: npm run cli -- add-team`);
    console.log(`   2. Validate config: npm run cli -- validate-config`);
  }

  private async validateConfig(configPath?: string): Promise<void> {
    try {
      const config = this.configManager.loadConfig(configPath);
      const teams = Object.keys(config.teams || {});

      if (teams.length === 0) {
        console.log('⚠️  No teams configured');
        console.log('   Add teams with: npm run cli -- add-team');
        return;
      }

      console.log(`✅ Configuration is valid`);
      console.log(`📋 Teams: ${teams.length}`);

      for (const teamId of teams) {
        const teamConfig = config.teams[teamId];
        if (teamConfig) {
          const envCount = Object.keys(teamConfig.environments || {}).length;
          const envList = Object.keys(teamConfig.environments || {}).join(', ');
          console.log(
            `   - ${teamConfig.teamName} (${teamId}): ${envCount} environments [${envList}]`
          );
          if (teamConfig.defaultEnvironment) {
            console.log(`     Default: ${teamConfig.defaultEnvironment}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Configuration validation failed:');
      console.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async listTeams(): Promise<void> {
    const teams = this.configManager.getAllTeams();
    const teamNames = this.configManager.getTeamNames();

    if (teams.length === 0) {
      console.log('❌ No teams configured');
      console.log('\n🎯 Add a team:');
      console.log('   npm run cli -- add-team');
      return;
    }

    console.log(`\n📋 Configured Teams (${teams.length})`);
    console.log('========================');

    teams.forEach((teamId, index) => {
      const teamConfig = this.configManager.getTeamConfig(teamId);
      const envs = Object.keys(teamConfig.environments);
      console.log(`${index + 1}. ${teamNames[teamId]} (${teamId})`);
      console.log(`   Environments: ${envs.join(', ')}`);
      if (teamConfig.defaultEnvironment) {
        console.log(`   Default: ${teamConfig.defaultEnvironment}`);
      }
    });

    console.log(`\n🌐 Example URLs:`);
    teams.slice(0, 3).forEach(teamId => {
      console.log(`   http://localhost:3000/elasticsearch?TEAM=${teamId}`);
    });

    console.log(`\n🛠️  Management:`);
    console.log(`   Test team: npm run cli -- test-team <team-id>`);
    console.log(`   Add team:  npm run cli -- add-team`);
    console.log(`   Remove:    npm run cli -- remove-team <team-id>`);
  }

  private async testTeam(teamId?: string): Promise<void> {
    if (!teamId) {
      console.error('❌ Please specify a team ID');
      console.log('Usage: npm run cli -- test-team <team-id>');
      return;
    }

    try {
      const teamConfig = this.configManager.getTeamConfig(teamId);
      console.log(`\n🔌 Testing team: ${teamConfig.teamName} (${teamId})`);
      console.log('============================================');

      const availableEnvs = Object.keys(teamConfig.environments);

      let successCount = 0;
      for (const env of availableEnvs) {
        try {
          console.log(`Testing ${env}...`);
          const isConnected = await this.elasticsearchService.testConnection(teamId, env);

          if (isConnected) {
            console.log(`  ✅ ${env}: Connected`);
            successCount++;
          } else {
            console.log(`  ❌ ${env}: Connection failed`);
          }
        } catch (error) {
          console.log(`  ❌ ${env}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      console.log(`\n📊 Results: ${successCount}/${availableEnvs.length} environments connected`);

      if (successCount === availableEnvs.length) {
        console.log('🎉 All environments are working correctly!');
      } else if (successCount > 0) {
        console.log('⚠️  Some environments have connection issues');
      } else {
        console.log('❌ No environments are accessible');
      }
    } catch (error) {
      console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private showHelp(): void {
    console.log(`
🚀 Elasticsearch MCP Multi-Team CLI
===================================

Commands:
  generate-config [path]     Generate empty teams configuration
  validate-config [path]     Validate teams configuration  
  list-teams                 List all configured teams
  add-team                   Add a new team (interactive)
  remove-team <team-id>      Remove a team
  test-team <team-id>        Test team's Elasticsearch connections

Examples:
  npm run cli -- generate-config
  npm run cli -- add-team
  npm run cli -- list-teams
  npm run cli -- test-team frontend
  npm run cli -- remove-team backend

Configuration:
  Default config file: ./teams-config.json
  Teams start empty - use add-team to configure
  Environments: Define custom environments (dev, staging, prod, testing, etc.)
    `);
  }
}

const cli = new ElasticsearchMCPCLI();
cli.run().catch(error => {
  console.error('CLI Error:', error);
  process.exit(1);
});
