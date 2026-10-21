import { ButtonLink } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="container-page flex flex-col items-center py-32 text-center animate-fade-up">
      <p className="text-small text-tertiary">404</p>
      <h1 className="page-title mt-2">Nothing here.</h1>
      <p className="mt-3 text-body text-secondary">The page you’re looking for doesn’t exist.</p>
      <ButtonLink to="/" className="mt-8">
        Go home
      </ButtonLink>
    </div>
  );
}
