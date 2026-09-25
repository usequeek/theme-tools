// Placeholder for type-checking the preview source. `queek-theme dev` replaces
// it with the real file, pointing at the developer's theme.
import type { ThemeModule } from '@usequeek/theme-kit/types/theme';
import type { ThemeDesignsConfig } from './designs';

declare const theme: ThemeModule;
export default theme;
export declare const config: ThemeDesignsConfig;
export declare const THEME_DIR: string;
