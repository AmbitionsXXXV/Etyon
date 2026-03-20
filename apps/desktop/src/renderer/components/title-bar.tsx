const TITLEBAR_HEIGHT = 36

export const TitleBar = () => (
  <div
    className="title-bar-drag fixed inset-x-0 top-0 z-50 flex select-none items-center bg-background/80 backdrop-blur-sm"
    style={{ height: TITLEBAR_HEIGHT }}
  />
)

export const TITLE_BAR_HEIGHT = TITLEBAR_HEIGHT
