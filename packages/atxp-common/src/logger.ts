/* eslint-disable no-console */
import { assertNever } from './utils.js';
import { Logger, LogLevel } from './types.js';

export class ConsoleLogger implements Logger {
  private readonly prefix: string;
  private _level: LogLevel;

  constructor({prefix = '[atxp]', level = LogLevel.INFO}: Partial<{prefix: string, level: LogLevel}> = {}) {
    this.prefix = prefix;
    this._level = level;
  }

  get level(): LogLevel {
    return this._level;
  }

  set level(level: LogLevel) {
    this._level = level;
  }

  private log(level: LogLevel, message: string) {
    if (level >= this._level) {
      const consoleMethod = this.getConsoleMethod(level);
      consoleMethod(`${this.prefix} ${message}`);
    }
  }

  private getConsoleMethod(level: LogLevel): (message: string) => void {
    switch (level) {
      case LogLevel.DEBUG: return console.debug.bind(console);
      case LogLevel.INFO: return console.info.bind(console);
      case LogLevel.WARN: return console.warn.bind(console);
      case LogLevel.ERROR: return console.error.bind(console);
      default: return assertNever(level, `Unknown log level: ${level}`);
    }
  }

  debug = (message: string) => {
    this.log(LogLevel.DEBUG, message);
  }
  info = (message: string) => {
    this.log(LogLevel.INFO, message);
  }
  warn = (message: string) => {
    this.log(LogLevel.WARN, message);
  }
  error = (message: string) => {
    this.log(LogLevel.ERROR, message);
  }
}