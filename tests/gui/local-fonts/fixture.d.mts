export function verifyFixtures(): Promise<{ files: Record<string, string>; sampleText: string }>;
export function installFixtureFont(environment: { platform: string; home?: string; localAppData?: string }): Promise<{
  path: string; cleanup(): Promise<void>;
}>;
