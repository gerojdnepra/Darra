const nextOutputMode = process.env.NEXT_OUTPUT_MODE;
const distDir =
  nextOutputMode === "export"
    ? ".next-export"
    : process.env.NODE_ENV === "development"
      ? ".next-dev"
      : ".next-prod";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir,
  output: nextOutputMode === "export" ? "export" : undefined,
  trailingSlash: nextOutputMode === "export"
};

export default nextConfig;
