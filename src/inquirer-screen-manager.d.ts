declare module 'inquirer/lib/utils/screen-manager' {
  class ScreenManager {
    constructor(rl: any);
    rl: any;
    height: number;
    normalizedCliWidth(): number;
    forceLineReturn(content: string, width?: number): string;
    render(content: string, bottomContent?: string): void;
    done(): void;
  }
  export = ScreenManager;
}
