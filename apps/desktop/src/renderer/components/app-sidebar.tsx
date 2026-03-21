import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader
} from "@etyon/ui/components/sidebar"

export const AppSidebar = () => (
  <Sidebar collapsible="offcanvas" side="left">
    <SidebarHeader className="title-bar-drag pt-6" />

    <SidebarContent />

    <SidebarFooter />
  </Sidebar>
)
