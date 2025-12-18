import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SDButton, SDText } from './index';
import { theme } from '../../theme';

interface AuthErrorModalProps {
  visible: boolean;
  onClose: () => void;
  onSignIn: () => void;
}

export function AuthErrorModal({ visible, onClose, onSignIn }: AuthErrorModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="lock-closed-outline" size={32} color={theme.colors.brand} />
            </View>
            <SDText variant="subtitle" weight="bold" style={styles.title}>
              Sign in required
            </SDText>
          </View>

          <View style={styles.body}>
            <SDText color="textMuted" style={styles.message}>
              You need to sign in to rate a dish. Please sign in to your account or create a new one.
            </SDText>
          </View>

          <View style={styles.actions}>
            <SDButton
              title="Go back"
              tone="surface"
              onPress={onClose}
              style={styles.button}
            />
            <SDButton
              title="Sign in"
              onPress={onSignIn}
              style={styles.button}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  modalContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${theme.colors.brand}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  message: {
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  button: {
    flex: 1,
  },
});
