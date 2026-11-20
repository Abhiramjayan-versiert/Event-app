/** Re-mounts on every navigation, so each page glides in like liquid. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="liquid-page">{children}</div>;
}
