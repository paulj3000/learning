import { Route, Routes } from 'react-router-dom';
import { Home } from '../routes/Home';
import { NotFound } from '../routes/NotFound';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
