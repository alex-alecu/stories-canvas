import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  captureMarketingAttribution,
  loadMarketingPixels,
  trackPageView,
} from '../lib/marketing';

export default function MarketingRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    captureMarketingAttribution();
    loadMarketingPixels();
    trackPageView(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return null;
}
