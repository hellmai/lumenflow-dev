// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

declare module 'micromatch' {
  interface MicromatchOptions {
    nocase?: boolean;
  }

  interface MicromatchStatic {
    isMatch(
      str: string,
      patterns: string | readonly string[],
      options?: MicromatchOptions,
    ): boolean;
  }

  const micromatch: MicromatchStatic;
  export default micromatch;
}
