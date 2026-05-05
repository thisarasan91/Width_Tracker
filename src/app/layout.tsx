import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TB Meter",
  description: "Device workflow and measurement verification for Raspberry Pi width stations"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
