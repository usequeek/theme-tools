import type { ThemeBlocks, ThemeModule } from '@usequeek/theme-kit/types/theme';
import {
  resolveThemeBlock,
  resolveThemeFooter,
  resolveThemeHeader,
  type ThemeVariantImplementations,
} from '@usequeek/theme-kit/theme-variant-resolver';
import { CoreContentDefaultBlock } from '@usequeek/theme-kit/shared-blocks';
import manifest from './manifest';
import { Layout } from './layout';
import { Header } from './header';
import { Footer } from './footer';
import { GalleryBlock } from './blocks/gallery';
import { ProductsBlock } from './blocks/products';
import { CategoriesBlock } from './blocks/categories';
import { ContactBlock } from './blocks/contact';
import { ModalLayer } from './modal-layer';
import { Home } from './pages/home';
import { PageView } from './pages/page';
import { Blog } from './pages/blog';
import { PostView } from './pages/post';
import { Collections } from './pages/collections';
import { Collection } from './pages/collection';
import { Shop } from './pages/shop';
import { Product } from './pages/product';
import { GalleryPage } from './pages/gallery-page';
import { CartShell } from './shells/cart-shell';
import { LoginShell } from './shells/login-shell';
import { SignupShell } from './shells/signup-shell';
import { AccountShell } from './shells/account-shell';

/**
 * Every variant this theme declares, mapped to the component that renders it.
 * The theme check (`npm run check`) holds this and manifest.ts to each other exactly — a
 * variant here with no manifest entry can never be chosen, and one in the
 * manifest with nothing here shows a merchant an option that does nothing.
 */
export const variantImplementations = {
  header: { default: Header },
  footer: { default: Footer },
  gallery: { banner: GalleryBlock },
  products: { grid: ProductsBlock },
  categories: { grid: CategoriesBlock },
  contact: { default: ContactBlock },
} satisfies ThemeVariantImplementations;

/** How each variant lays out, for the backend's section picker. */
export const variantShapes = {
  gallery: { banner: 'hero' },
  products: { grid: 'grid' },
  categories: { grid: 'grid' },
} as const;

const blockMap: ThemeBlocks = {
  content: CoreContentDefaultBlock,
  gallery: GalleryBlock,
  products: ProductsBlock,
  categories: CategoriesBlock,
  // Declared so a page authored for another theme cannot crash this one. Give
  // them real renderers (and manifest variants) when your design covers them.
  contact: ContactBlock,
  blog: () => null,
};

const getBlock: ThemeModule['getBlock'] = (type, variant) =>
  resolveThemeBlock(variantImplementations, type, variant, blockMap[type]) as ThemeBlocks[typeof type];

const theme: ThemeModule = {
  Layout,
  Header,
  Footer,
  blocks: blockMap,
  getHeader: (variant?: string) => resolveThemeHeader(variantImplementations, variant, Header),
  getFooter: (variant?: string) => resolveThemeFooter(variantImplementations, variant, Footer),
  getBlock,
  pages: { Home, Page: PageView, Blog, Post: PostView, Collections, Collection, Shop, Product, Gallery: GalleryPage },
  shells: { CartShell, LoginShell, SignupShell, AccountShell },
  ModalLayer,
  manifest,
};

export default theme;
