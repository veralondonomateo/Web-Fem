import AdminShell from "./AdminShell";

export const metadata = { title: "FEM Admin" };

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
