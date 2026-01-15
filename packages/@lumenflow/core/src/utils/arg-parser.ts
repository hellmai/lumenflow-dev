/**
 * ArgParser - Command-line argument parsing utility (WU-2537)
 * @module @lumenflow/core/utils
 */

export interface OptionDefinition {
  type: 'string' | 'boolean';
  required?: boolean;
  alias?: string;
  default?: string | boolean;
}

export interface ArgParseResult {
  options: Record<string, string | boolean | undefined>;
  positional: string[];
}

export class ArgParser {
  private readonly commandName: string;
  private readonly options: Map<string, OptionDefinition> = new Map();
  private readonly aliases: Map<string, string> = new Map();

  constructor(commandName: string) {
    this.commandName = commandName;
  }

  addOption(name: string, definition: OptionDefinition): void {
    const normalizedName = this.normalizeName(name);
    this.options.set(normalizedName, definition);
    if (definition.alias) {
      this.aliases.set(this.normalizeName(definition.alias), normalizedName);
    }
  }

  parse(args: string[]): ArgParseResult {
    const result: ArgParseResult = { options: {}, positional: [] };

    for (const [name, def] of this.options) {
      if (def.default !== undefined) {
        result.options[name] = def.default;
      }
    }

    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (!arg) {
        i++;
        continue;
      }

      if (arg.startsWith('-')) {
        const normalizedArg = this.normalizeName(arg);
        const optionName = this.aliases.get(normalizedArg) ?? normalizedArg;
        const definition = this.options.get(optionName);

        if (definition) {
          if (definition.type === 'boolean') {
            result.options[optionName] = true;
            i++;
          } else {
            const value = args[i + 1];
            if (!value || value.startsWith('-')) {
              throw new Error(`Option ${arg} requires a value`);
            }
            result.options[optionName] = value;
            i += 2;
          }
        } else {
          i++;
        }
      } else {
        result.positional.push(arg);
        i++;
      }
    }

    for (const [name, def] of this.options) {
      if (def.required && result.options[name] === undefined) {
        throw new Error(`Option --${name} is required for ${this.commandName}`);
      }
    }

    return result;
  }

  private normalizeName(name: string): string {
    return name.replace(/^-+/, '');
  }
}
