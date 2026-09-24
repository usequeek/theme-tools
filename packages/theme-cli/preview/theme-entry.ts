// Placeholder for type-checking the preview source. `queek-theme dev` replaces
// it with the real file, pointing at the developer's theme.
import type { ThemeModule } from '@usequeek/theme-kit/types/theme';

declare const theme: ThemeModule;
export default theme;
export declare const config: { name?: string; default_demo?: { label?: string }; demos?: Array<{ id: string; label?: string }> };
export declare const THEME_DIR: string;
