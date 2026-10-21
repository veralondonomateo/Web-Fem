if(process.env.FEM_CHECKOUT_ENV_JSON) Object.assign(process.env,JSON.parse(process.env.FEM_CHECKOUT_ENV_JSON));
import type { NextConfig } from "next";
import {fileURLToPath} from 'node:url';

const nextConfig: NextConfig = {
  turbopack: { root: fileURLToPath(new URL('../..',import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL('../..',import.meta.url)),
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
