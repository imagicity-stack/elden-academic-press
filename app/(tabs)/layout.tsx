import { TabBar } from '@/components/TabBar';

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main style={{ paddingBottom: 'calc(116px + var(--safe-b))' }}>{children}</main>
      <TabBar />
    </>
  );
}
