import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Panel clínico",
  description:
    "Prepara fotos de casos dentales y revisa el texto antes de publicarlo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${sourceSans.className} bg-stone-100 text-stone-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
