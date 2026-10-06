import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JANTOK Admin",
  description: "Операционная панель JANTOK Food",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="kk">
      <body>{children}</body>
    </html>
  );
}
