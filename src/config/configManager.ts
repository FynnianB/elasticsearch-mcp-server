import * as fs from 'fs';
import * as path from 'path';
import type { MultiTeamConfig, TeamConfig } from '../types.js';

export class ConfigManager {
  private config: MultiTeamConfig;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = this.loadConfig();
  }

  private getDefaultConfigPath(): string {
    const possiblePaths = [
      path.join(process.cwd(), 'teams-config.json'),
      path.join(process.cwd(), 'config', 'teams.json'),
    ].filter(Boolean);

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    const defaultPath = path.join(process.cwd(), 'teams-config.json');
    this.createEmptyConfig(defaultPath);
    return defaultPath;
  }

  private createEmptyConfig(configPath: string): void {
    const emptyConfig: MultiTeamConfig = {
      server: {
        name: 'elasticsearch-mcp',
        version: '1.0.0',
      },
      teams: {},
    };

    fs.writeFileSync(configPath, JSON.stringify(emptyConfig, null, 2), 'utf-8');
    console.log(`📝 Created empty teams configuration: ${configPath}`);
  }

  public loadConfig(configPath?: string): MultiTeamConfig {
    const targetPath = configPath || this.configPath;

    try {
      if (!fs.existsSync(targetPath)) {
        return {
          server: {
            name: 'elasticsearch-mcp',
            version: '1.0.0',
          },
          teams: {},
        };
      }

      const configContent = fs.readFileSync(targetPath, 'utf-8');
      const config = JSON.parse(configContent) as MultiTeamConfig;
      this.validateConfig(config);
      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in config file ${targetPath}: ${error.message}`);
      }
      throw new Error(
        `Failed to load config from ${targetPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  public saveConfig(config: MultiTeamConfig, configPath?: string): void {
    const targetPath = configPath || this.configPath;
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');

    if (targetPath === this.configPath) {
      this.config = config;
    }
  }

  private validateConfig(config: MultiTeamConfig): void {
    if (!config.teams || typeof config.teams !== 'object') {
      throw new Error('Configuration must have a "teams" object');
    }

    if (Object.keys(config.teams).length === 0) {
      return;
    }

    for (const [teamId, teamConfig] of Object.entries(config.teams)) {
      this.validateTeamConfig(teamId, teamConfig);
    }
  }

  private validateTeamConfig(teamId: string, teamConfig: TeamConfig): void {
    if (!teamConfig.teamName) {
      throw new Error(`Team ${teamId} must have a teamName`);
    }

    if (!teamConfig.environments) {
      throw new Error(`Team ${teamId} must have environments configuration`);
    }

    const configuredEnvs = Object.entries(teamConfig.environments).filter(
      ([, config]) => config.node
    );

    if (configuredEnvs.length === 0) {
      throw new Error(
        `Team ${teamId} must have at least one environment configured with a node URL`
      );
    }

    if (teamConfig.defaultEnvironment) {
      const availableEnvs = Object.keys(teamConfig.environments);
      if (!availableEnvs.includes(teamConfig.defaultEnvironment)) {
        throw new Error(
          `Team ${teamId} defaultEnvironment "${
            teamConfig.defaultEnvironment
          }" must be one of the configured environments: ${availableEnvs.join(', ')}`
        );
      }

      if (!teamConfig.environments[teamConfig.defaultEnvironment]?.node) {
        throw new Error(
          `Team ${teamId} defaultEnvironment "${teamConfig.defaultEnvironment}" must have a node URL configured`
        );
      }
    }

    if (!teamConfig.indexPatterns) {
      throw new Error(`Team ${teamId} must have indexPatterns configuration`);
    }

    if (
      !teamConfig.indexPatterns.exceptions ||
      !Array.isArray(teamConfig.indexPatterns.exceptions)
    ) {
      throw new Error(`Team ${teamId} must have exceptions index patterns as an array`);
    }

    if (
      !teamConfig.indexPatterns.applications ||
      !Array.isArray(teamConfig.indexPatterns.applications)
    ) {
      throw new Error(`Team ${teamId} must have applications index patterns as an array`);
    }
  }

  public getTeamConfig(teamId: string): TeamConfig {
    const teamConfig = this.config.teams[teamId];
    if (!teamConfig) {
      const availableTeams = Object.keys(this.config.teams).join(', ');
      throw new Error(`Team '${teamId}' not found. Available teams: ${availableTeams || 'none'}`);
    }
    return teamConfig;
  }

  public getAllTeams(): string[] {
    return Object.keys(this.config.teams);
  }

  public getTeamNames(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [teamId, config] of Object.entries(this.config.teams)) {
      result[teamId] = config.teamName;
    }
    return result;
  }

  public getAllEnvironments(): string[] {
    const environments = new Set<string>();
    for (const teamConfig of Object.values(this.config.teams)) {
      Object.keys(teamConfig.environments).forEach(env => environments.add(env));
    }
    return Array.from(environments);
  }

  public getServerConfig() {
    return this.config.server;
  }

  public reloadConfig(): void {
    this.config = this.loadConfig();
  }

  public addTeam(teamConfig: TeamConfig): void {
    const teamId = teamConfig.teamId;
    if (this.config.teams[teamId]) {
      throw new Error(`Team '${teamId}' already exists`);
    }

    this.config.teams[teamId] = teamConfig;
    this.saveConfig(this.config);
  }

  public removeTeam(teamId: string): void {
    if (!this.config.teams[teamId]) {
      throw new Error(`Team '${teamId}' not found`);
    }

    delete this.config.teams[teamId];
    this.saveConfig(this.config);
  }
}
