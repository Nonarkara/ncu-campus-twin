import { Component, type ReactNode } from 'react';

export class MapBoundary extends Component<{ children: ReactNode; l: 'en' | 'zh' }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const en = this.props.l === 'en';
    return (
      <div id="map" className="map map-loading">
        <div className="map-message">
          <p role="status">{en ? 'Campus map unavailable.' : '校園地圖目前無法載入。'}</p>
          <button onClick={() => location.reload()}>{en ? 'Reload page' : '重新載入'}</button>
        </div>
      </div>
    );
  }
}
