import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: {
    default: 'Fem CRM',
    template: '%s · Fem CRM',
  },
  description: 'CRM de Fem — bandeja omnicanal, pedidos, flujos automáticos y retención.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#FF9DA3',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans">
        {children}
        {/* Mide el tiempo real que ve cada agente, no el del servidor: la
            diferencia entre los dos es justo lo que se estaba notando. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
