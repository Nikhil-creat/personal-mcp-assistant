import "./globals.css";
export const metadata = { title: "Personal MCP Assistant" };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="antialiased">{children}</body></html>;
}
