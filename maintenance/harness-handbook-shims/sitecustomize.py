"""Compatibility shim for the pinned Harness Handbook runtime."""

try:
    from tree_sitter import Node

    if not hasattr(Node, "kind") and hasattr(Node, "type"):
        Node.kind = property(lambda self: self.type)
    if not hasattr(Node, "start_position") and hasattr(Node, "start_point"):
        Node.start_position = property(lambda self: self.start_point)
    if not hasattr(Node, "end_position") and hasattr(Node, "end_point"):
        Node.end_position = property(lambda self: self.end_point)
except ImportError:
    pass
