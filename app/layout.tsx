import type { Metadata, Viewport } from 'next';
import { Manrope, Plus_Jakarta_Sans } from 'next/font/google';
import { Gate } from '@/components/Gate';
import { Toast } from '@/components/Toast';
import { loadCatalog } from '@/lib/catalog';
import { AppProvider } from '@/lib/store';
import './globals.css';

const display = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--fd' });
const body = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--fb' });

export const metadata: Metadata = {
  title: 'ElMaster · by Elden Academic Press',
  description: 'Courses, olympiad prep, mock tests and live classes from India’s finest teachers.',
  applicationName: 'ElMaster',
  appleWebApp: { capable: true, title: 'ElMaster', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A1F4D',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const catalog = await loadCatalog();
  return (
    <html lang="en-IN" className={`${display.variable} ${body.variable}`}>
      <head>
        {/* Material Symbols needs its FILL axis, which next/font can't subset. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0&display=block" />
      </head>
      <body>
        <AppProvider catalog={catalog}>
          <div className="app">
            <Gate>{children}</Gate>
          </div>
          <Toast />
        </AppProvider>
      </body>
    </html>
  );
}
