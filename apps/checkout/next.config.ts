if(process.env.FEM_CHECKOUT_ENV_JSON) Object.assign(process.env,JSON.parse(process.env.FEM_CHECKOUT_ENV_JSON));
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
    ],
  },
};

export default nextConfig;
