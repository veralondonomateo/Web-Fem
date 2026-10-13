import {cookies} from "next/headers";
import type { Metadata } from "next";

import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "FEM | Finalizar compra",
  description: "Checkout seguro - FEM Suplementos",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const marketing=(await cookies()).get("fem_consent")?.value === "all";
  return (
    <html lang="es" className="h-full">
      <head><link rel="stylesheet" href="/__theme/fem-fonts.css" />
        {/* Las imágenes de producto (LCP) vienen del CDN de Shopify: abrimos la
            conexión antes de que el HTML termine de parsearse. */}
        <link rel="preconnect" href="https://cdn.shopify.com" crossOrigin="" />
        {/* Los pixeles cargan después del load; basta resolver el DNS por adelantado. */}
        <link rel="dns-prefetch" href="https://connect.facebook.net" />
        <link rel="dns-prefetch" href="https://analytics.tiktok.com" />
        {/* Klaviyo ya no sirve scripts aquí; solo se le manda un evento. */}
        <link rel="dns-prefetch" href="https://a.klaviyo.com" />

        {/* TikTok Pixel base code — lazyOnload: no compite con la hidratación */}
        {marketing && process.env.NEXT_PUBLIC_FEM_PREVIEW !== "true" && <Script id="tiktok-pixel" strategy="lazyOnload">{`
          !function (w, d, t) {
            w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
            var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
            ;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
            ttq.load('D7EG6BJC77UB0P248N8G');
            ttq.page();
          }(window, document, 'ttq');
        `}</Script>}
        {/* Meta Pixel base code */}
        {marketing && process.env.NEXT_PUBLIC_FEM_PREVIEW !== "true" && <Script id="meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '1382746760142604');
          fbq('track', 'PageView');
        `}</Script>}
        {marketing && process.env.NEXT_PUBLIC_FEM_PREVIEW !== "true" && <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=1382746760142604&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>}
        {/* Klaviyo NO carga su script onsite aquí a propósito.
            klaviyo.js es lo que renderiza el popup de captura de emails, que en
            el checkout se montaba encima del formulario de pago y arrastraba
            ~14 archivos más. Lo único que necesitamos de Klaviyo en esta página
            es el evento "Started Checkout", y eso se envía con una sola
            petición a la Client API desde lib/klaviyo.ts.
            Consecuencia buscada: cero JS de terceros de Klaviyo y sin popup.
            "Active on Site" deja de registrarse SOLO en el checkout; en la
            tienda Shopify sigue igual, porque allí el script no se tocó. */}
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}<Script src="/__theme/fem-consent.js" strategy="afterInteractive" /></body>
    </html>
  );
}
