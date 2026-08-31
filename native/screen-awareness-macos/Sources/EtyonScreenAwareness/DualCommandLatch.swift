struct DualCommandLatch {
  private(set) var isLatched = false

  mutating func update(
    leftCommandIsDown: Bool,
    rightCommandIsDown: Bool
  ) -> Bool {
    if leftCommandIsDown && rightCommandIsDown {
      guard !isLatched else {
        return false
      }

      isLatched = true
      return true
    }

    if !leftCommandIsDown && !rightCommandIsDown {
      isLatched = false
    }

    return false
  }
}
