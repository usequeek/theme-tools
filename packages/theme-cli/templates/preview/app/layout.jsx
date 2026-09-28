import '@usequeek/theme-kit/shared-blocks/core-blocks.css';
import '@usequeek/theme-kit/apps/apps.css';
import '../theme-styles';
export const metadata = {
    title: 'Theme preview',
    robots: 'noindex, nofollow',
};
export default function RootLayout({ children }) {
    return (<html lang="en">
      <body>{children}</body>
    </html>);
}
