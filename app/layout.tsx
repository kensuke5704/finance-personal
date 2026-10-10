import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "../components/PwaRegister";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Finance",
  description: "月次の資産記録と予算・資産予測",
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "Finance", statusBarStyle: "default" },
  icons: {
    icon: [{ url: `${basePath}/icons/icon.svg`, type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f1ea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body><PwaRegister />{children}</body>
    </html>
  );
}
