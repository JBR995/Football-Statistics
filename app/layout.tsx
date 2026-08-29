import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'ElevenLab — Football Intelligence',
  description: 'Study football data, surface hidden patterns, and build transparent match predictions with AI-assisted analysis.',
  openGraph: {
    title: 'ElevenLab — Football Intelligence',
    description: 'Football intelligence, decoded. Study the data, surface patterns, and model match outcomes.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'ElevenLab football intelligence dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ElevenLab — Football Intelligence',
    description: 'Football intelligence, decoded.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
