import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import StoryGrid from '../components/StoryGrid';
import { useUserStories, useDeleteStory } from '../hooks/useStories';

export default function Profile() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: stories = [], isLoading: storiesLoading } = useUserStories(!!user);
  const deleteStory = useDeleteStory();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login?returnTo=/profile', { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary-300 border-t-primary-600 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Utilizator';
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const email = user.email;

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Ești sigur că vrei să ștergi această poveste?')) return;
    try {
      await deleteStory.mutateAsync(id);
    } catch {
      alert('Nu s-a putut șterge povestea');
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Profile header */}
        <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-100 p-6 md:p-8 mb-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-20 h-20 rounded-full border-4 border-primary-200 shadow-md"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-center sm:text-left flex-1">
              <h1 className="text-2xl font-extrabold text-gray-800">{displayName}</h1>
              {email && <p className="text-gray-500">{email}</p>}
            </div>
            <button
              onClick={handleSignOut}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 px-6 rounded-xl transition-colors text-sm"
            >
              Deconectare
            </button>
          </div>
        </div>

        {/* User's stories */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-700 mb-4">Poveștile mele</h2>
        </div>

        {stories.length === 0 && !storiesLoading ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4 opacity-50">~</div>
            <h3 className="text-xl font-bold text-gray-400 mb-2">Nu ai nicio poveste încă</h3>
            <p className="text-gray-400 mb-6">Creează prima ta poveste magică!</p>
            <Link
              to="/"
              className="inline-block bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-bold py-3 px-8 rounded-xl transition-all transform hover:scale-[1.02]"
            >
              Creează o poveste
            </Link>
          </div>
        ) : (
          <StoryGrid stories={stories} isLoading={storiesLoading} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}
