/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The node's RPC credentials live only in server-side env vars. Nothing here
  // is exposed to the browser (no NEXT_PUBLIC_* for anything credential-shaped).
  poweredByHeader: false,
};

export default nextConfig;
