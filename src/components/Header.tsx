import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Header() {
  const { user, loading, signOut } = useAuth();

  return (
    <header className="w-full border-b border-primary-100 bg-white/70 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        <Link
          to="/"
          className="text-lg font-extrabold bg-gradient-to-r from-primary-600 to-primary-500 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
        >
          Povești Magice
        </Link>

        <nav className="flex items-center gap-3">
          {loading ? (
            <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse" />
          ) : user ? (
            <>
              <Link
                to="/profile"
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={user.user_metadata?.full_name || 'Profil'}
                    className="w-8 h-8 rounded-full border-2 border-primary-200"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold">
                    {(user.user_metadata?.full_name || user.email || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-gray-700 hidden sm:inline">
                  {user.user_metadata?.full_name || user.email || 'Profil'}
                </span>
              </Link>
              <button
                onClick={signOut}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors ml-2"
              >
                Deconectare
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="text-sm font-bold text-primary-600 hover:text-primary-700 transition-colors"
            >
              Conectare
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
