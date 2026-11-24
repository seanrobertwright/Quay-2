import { Component, type ReactNode } from "react";

interface SurfaceBoundaryProps {
  /** The revision of the surface. One that could not be drawn is tried again at the next. */
  revision?: number;
  children: ReactNode;
}

/** Keeps a surface that cannot be drawn from taking the rest of Quay's window with it. */
export class SurfaceBoundary extends Component<SurfaceBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate({ revision }: SurfaceBoundaryProps) {
    if (this.state.failed && revision !== this.props.revision) this.setState({ failed: false });
  }

  componentDidCatch(error: unknown) {
    console.error("[surfaces] A surface could not be drawn", error);
  }

  render() {
    return this.state.failed ? <p role="alert">Quay could not draw this.</p> : this.props.children;
  }
}
