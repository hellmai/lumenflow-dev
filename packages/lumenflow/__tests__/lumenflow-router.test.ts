import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPATCH, resolveDispatchTarget } from '../bin/lumenflow.mjs';

const SAMPLE_MANIFEST = Object.freeze([
  {
    name: 'wu:claim',
    binName: 'wu-claim',
    binPath: './dist/wu-claim.js',
  },
  {
    name: 'lane:status',
    binName: 'lane-status',
    binPath: './dist/lane-status.js',
  },
  {
    name: 'lumenflow-integrate',
    binName: 'lumenflow-integrate',
    binPath: './dist/commands/integrate.js',
  },
]);

const COMMAND_FLAG_HELP = '--help';
const COMMAND_TOKEN_INIT = 'init';
const COMMAND_TOKEN_WU_CLAIM = 'wu:claim';
const COMMAND_TOKEN_WU_CLAIM_BIN = 'wu-claim';
const COMMAND_TOKEN_LANE_STATUS = 'lane:status';
const COMMAND_TOKEN_UNKNOWN = 'totallyunknowncommand';
const FLAG_FORCE = '--force';
const EMPTY_MANIFEST: readonly Record<string, string>[] = Object.freeze([]);

describe('resolveDispatchTarget', () => {
  it('routes no-argument invocation to commands entry', () => {
    const target = resolveDispatchTarget([], SAMPLE_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: DEFAULT_DISPATCH.commandsEntry,
      forwardedArgs: [],
    });
  });

  it('routes help flag to commands entry', () => {
    const target = resolveDispatchTarget([COMMAND_FLAG_HELP], SAMPLE_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: DEFAULT_DISPATCH.commandsEntry,
      forwardedArgs: [],
    });
  });

  it('routes explicit command names through manifest mapping', () => {
    const target = resolveDispatchTarget([COMMAND_TOKEN_WU_CLAIM, FLAG_FORCE], SAMPLE_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: 'wu-claim.js',
      forwardedArgs: [FLAG_FORCE],
    });
  });

  it('routes explicit bin names through manifest mapping', () => {
    const target = resolveDispatchTarget([COMMAND_TOKEN_WU_CLAIM_BIN, FLAG_FORCE], SAMPLE_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: 'wu-claim.js',
      forwardedArgs: [FLAG_FORCE],
    });
  });

  it('routes init token to init entry and strips command token', () => {
    const target = resolveDispatchTarget([COMMAND_TOKEN_INIT, FLAG_FORCE], SAMPLE_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: DEFAULT_DISPATCH.initEntry,
      forwardedArgs: [FLAG_FORCE],
    });
  });

  it('falls back to init entry for unknown command tokens', () => {
    const target = resolveDispatchTarget([COMMAND_TOKEN_UNKNOWN, FLAG_FORCE], SAMPLE_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: DEFAULT_DISPATCH.initEntry,
      forwardedArgs: [COMMAND_TOKEN_UNKNOWN, FLAG_FORCE],
    });
  });

  it('derives colon-dispatched entrypoints when manifest data is unavailable', () => {
    const target = resolveDispatchTarget([COMMAND_TOKEN_LANE_STATUS, FLAG_FORCE], EMPTY_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: 'lane-status.js',
      forwardedArgs: [FLAG_FORCE],
    });
  });

  it('derives hyphenated entrypoints when manifest data is unavailable', () => {
    const target = resolveDispatchTarget([COMMAND_TOKEN_WU_CLAIM_BIN, FLAG_FORCE], EMPTY_MANIFEST);
    expect(target).toStrictEqual({
      entryRelativePath: 'wu-claim.js',
      forwardedArgs: [FLAG_FORCE],
    });
  });
});
