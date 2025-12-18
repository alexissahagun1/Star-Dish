import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '../components/Screen';
import { SDText } from '../components/ui';
import { lightHaptic } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

type AuthUser = Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'];

export function ProfileScreen() {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const trimmedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const [password, setPassword] = useState('');
  const trimmedPassword = useMemo(() => password.trim(), [password]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await supabase.auth.getUser();
        if (!alive) return;
        setUser(res.data.user);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const canSubmit = useMemo(() => {
    // Minimal validation; Supabase will also validate server-side.
    const emailOk = trimmedEmail.includes('@') && trimmedEmail.includes('.');
    const pwOk = trimmedPassword.length >= 6;
    return emailOk && pwOk;
  }, [trimmedEmail, trimmedPassword.length]);

  const signIn = useCallback(async () => {
    setError(null);
    setNotice(null);

    const nextEmail = trimmedEmail;
    const nextPassword = trimmedPassword;
    if (!nextEmail || !nextEmail.includes('@') || !nextEmail.includes('.')) {
      setError('Enter a valid email address.');
      return;
    }
    if (nextPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    await lightHaptic();
    Keyboard.dismiss();

    setActionLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: nextEmail,
        password: nextPassword,
      });
      if (signInError) throw signInError;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign in.');
    } finally {
      setActionLoading(false);
    }
  }, [trimmedEmail, trimmedPassword]);

  const signUp = useCallback(async () => {
    setError(null);
    setNotice(null);
    setActionLoading(true);
    try {
      const nextEmail = trimmedEmail;
      const nextPassword = trimmedPassword;
      if (!nextEmail || !nextEmail.includes('@') || !nextEmail.includes('.')) {
        setError('Enter a valid email address.');
        return;
      }
      if (nextPassword.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }

      await lightHaptic();
      Keyboard.dismiss();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: nextEmail,
        password: nextPassword,
      });
      if (signUpError) throw signUpError;

      // If email confirmation is enabled, Supabase won't return a session yet.
      if (!data.session) {
        setNotice('Account created. Check your email to confirm, then sign in.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setActionLoading(false);
    }
  }, [trimmedEmail, trimmedPassword]);

  const signOut = useCallback(async () => {
    setError(null);
    setNotice(null);
    setActionLoading(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign out.');
    } finally {
      setActionLoading(false);
    }
  }, []);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <SDText variant="title" weight="bold">
            Profile
          </SDText>
          <SDText color="textMuted">Account, identity, and sign-in.</SDText>
        </View>

        <View style={styles.card}>
          {loading ? (
            <View style={styles.row}>
              <ActivityIndicator color={theme.colors.textMuted} />
              <SDText color="textMuted">Loading…</SDText>
            </View>
          ) : user ? (
            <View style={styles.stack}>
              <SDText weight="semibold">Signed in</SDText>
              <SDText color="textMuted" variant="caption">
                User ID
              </SDText>
              <SDText>{user.id}</SDText>

              <SDText color="textMuted" variant="caption" style={{ marginTop: theme.spacing.sm }}>
                Email
              </SDText>
              <SDText>{user.email ?? '—'}</SDText>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                disabled={actionLoading}
                onPress={() => void signOut()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { marginTop: theme.spacing.md, opacity: actionLoading ? 0.55 : pressed ? 0.88 : 1 },
                ]}
              >
                <View style={styles.row}>
                  {actionLoading ? <ActivityIndicator color={theme.colors.black} /> : null}
                  <SDText weight="semibold" color="black">
                    Sign out
                  </SDText>
                </View>
              </Pressable>
            </View>
          ) : (
            <View style={styles.stack}>
              <SDText weight="semibold">Sign in</SDText>
              <SDText color="textMuted">Use your email and password. No redirect URL needed.</SDText>

              <View style={styles.emailRow}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@domain.com"
                  placeholderTextColor={theme.colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    // let password input handle submit
                  }}
                  style={styles.emailInput}
                />
              </View>

              <View style={styles.emailRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password (min 6 chars)"
                  placeholderTextColor={theme.colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  secureTextEntry
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    if (!canSubmit || actionLoading) return;
                    void signIn();
                  }}
                  style={styles.emailInput}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                disabled={!canSubmit || actionLoading}
                onPress={() => void signIn()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { opacity: !canSubmit || actionLoading ? 0.55 : pressed ? 0.88 : 1 },
                ]}
              >
                <View style={styles.row}>
                  {actionLoading ? <ActivityIndicator color={theme.colors.black} /> : null}
                  <SDText weight="semibold" color="black">
                    Sign in
                  </SDText>
                </View>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <SDText color="textMuted" variant="caption">
                  or
                </SDText>
                <View style={styles.divider} />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create account"
                disabled={!canSubmit || actionLoading}
                onPress={() => void signUp()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { opacity: !canSubmit || actionLoading ? 0.55 : pressed ? 0.88 : 1 },
                ]}
              >
                <View style={styles.row}>
                  <SDText weight="semibold" color="text">
                    Create account
                  </SDText>
                </View>
              </Pressable>
            </View>
          )}
        </View>

        {notice ? (
          <View style={styles.noticeCard}>
            <SDText weight="semibold">Check your inbox</SDText>
            <SDText color="textMuted" variant="caption">
              {notice}
            </SDText>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <SDText weight="semibold">Something went wrong</SDText>
            <SDText color="textMuted" variant="caption">
              {error}
            </SDText>
          </View>
        ) : null}

      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    paddingBottom: 110,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.bg,
  },
  header: {
    gap: 6,
  },
  card: {
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  noticeCard: {
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  errorCard: {
    borderRadius: theme.radii.xl,
    borderWidth: 1.5,
    borderColor: 'rgba(255,77,77,0.4)',
    backgroundColor: 'rgba(255,77,77,0.08)',
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  stack: {
    gap: theme.spacing.sm,
  },
  emailRow: {
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    minHeight: 52,
  },
  emailInput: {
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
  },
  primaryButton: {
    borderRadius: theme.radii.pill,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    shadowColor: theme.colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryButton: {
    borderRadius: theme.radii.pill,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
});




