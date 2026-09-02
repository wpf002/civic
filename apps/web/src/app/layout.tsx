import "./globals.css";
export const metadata = { title: "Civic", description: "See where candidates stand on the issues you care about." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body className="min-h-screen bg-white text-neutral-900">{children}</body></html>
  );
}
