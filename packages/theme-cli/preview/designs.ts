// The design resolver (contract R2.8), for type-checking the preview source
// and for its tests. `queek-theme dev` replaces the built file with a copy of
// @usequeek/theme-check/designs itself: that module imports nothing, and a
// copy needs no install in the developer's project (pnpm keeps theme-check
// under theme-cli, where the preview cannot resolve it).
export * from '@usequeek/theme-check/designs';
