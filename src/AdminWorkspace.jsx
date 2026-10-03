import './adminTools.css'

export default function AdminWorkspace({ title, Sidebar, WorkspaceTabs, navigationProps, children }) {
  return <div className="dashboard-shell admin-tools-shell"><Sidebar {...navigationProps} /><main className="admin-tools-main"><WorkspaceTabs {...navigationProps} /><header className="admin-tools-heading"><h1>{title}</h1></header>{children}</main></div>
}
