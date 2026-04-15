import { Navigate, useLocation } from 'react-router-dom';

export default function Billing() {
  const location = useLocation();

  return <Navigate to={`/profile${location.search}`} replace />;
}
