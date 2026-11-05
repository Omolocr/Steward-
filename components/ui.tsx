import { Logo } from './Logo';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { tr } from '../i18n';
import { useLang } from '../LangProvider';

export const C = {
  bg: '#F6F4EE', card: '#FFFFFF', ink: '#1F2A37', mute: '#6B7280', line: '#E5E1D6',
  primary: '#1F4E79', primarySoft: '#E3EDF7', gold: '#B8862B', ok: '#2E7D4F', warn: '#B45309', bad: '#B3261E',
};

// The English | Kiswahili switch shown at the top right of every screen.
export function LangSwitch() {
  const { lang, setLang } = useLang();
  const seg = (l: 'en' | 'sw', text: string) => (
    <Pressable onPress={() => setLang(l)} accessibilityLabel={l === 'en' ? 'English' : 'Kiswahili'} style={{ paddingHorizontal: 7, paddingVertical: 3, backgroundColor: lang === l ? '#fff' : 'transparent' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: lang === l ? C.primary : '#fff' }}>{text}</Text>
    </Pressable>
  );
  return <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: '#fff', borderRadius: 8, overflow: 'hidden', width: 64 }}>{seg('en', 'EN')}{seg('sw', 'SW')}</View>;
}

export function Screen({ title, onBack, children, scroll = true }: { title: string; onBack?: () => void; children: React.ReactNode; scroll?: boolean }) {
  const body = scroll ? <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1, padding: 16 }}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.header}>
        {onBack ? <Pressable onPress={onBack} hitSlop={12}><Text style={s.back}>‹ {tr('Back')}</Text></Pressable> : <View style={{ width: 64 }} />}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Logo size={26} /><Text style={s.title} numberOfLines={1}>{tr(title)}</Text></View>
        <LangSwitch />
      </View>
      {body}
    </View>
  );
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[s.card, style]}>{children}</View>;
export const H = ({ children }: { children: React.ReactNode }) => <Text style={s.h}>{typeof children === 'string' ? tr(children) : children}</Text>;
export const P = ({ children, mute, bold }: { children: React.ReactNode; mute?: boolean; bold?: boolean }) => (
  <Text style={{ color: mute ? C.mute : C.ink, fontSize: 14, lineHeight: 20, fontWeight: bold ? '700' : '400' }}>{typeof children === 'string' ? tr(children) : children}</Text>
);

export function Btn({ label, onPress, kind = 'primary', disabled, small }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'ok'; disabled?: boolean; small?: boolean }) {
  const bg = kind === 'primary' ? C.primary : kind === 'ok' ? C.ok : kind === 'danger' ? C.warn : 'transparent';
  const color = kind === 'ghost' ? C.primary : '#fff';
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: C.primary, paddingVertical: small ? 7 : 12 }]}>
      <Text style={{ color, fontWeight: '700', fontSize: small ? 13 : 15 }}>{tr(label)}</Text>
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{tr(label)}</Text>
      <TextInput placeholderTextColor="#9CA3AF" {...p} placeholder={p.placeholder ? tr(p.placeholder) : p.placeholder} style={[s.input, p.multiline && { minHeight: 90, textAlignVertical: 'top' }, p.style]} />
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T | T[]; onChange: (v: T) => void; labels?: Record<string, string> }) {
  const sel = Array.isArray(value) ? value : [value];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[s.chip, sel.includes(o) && { backgroundColor: C.primary, borderColor: C.primary }]}>
          <Text style={{ color: sel.includes(o) ? '#fff' : C.ink, fontSize: 13 }}>{tr(labels?.[o] ?? o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const Badge = ({ text, color = C.primary }: { text: string; color?: string }) => (
  <View style={{ backgroundColor: color + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' }}>
    <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{tr(text)}</Text>
  </View>
);

export const Empty = ({ text }: { text: string }) => <Text style={{ color: C.mute, textAlign: 'center', marginVertical: 24 }}>{tr(text)}</Text>;

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
      <View style={[s.box, value && { backgroundColor: C.primary, borderColor: C.primary }]}>{value && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}</View>
      <Text style={{ color: C.ink, fontSize: 14 }}>{tr(label)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.primary, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 6 },
  back: { color: '#fff', fontSize: 15, width: 64 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  h: { fontSize: 16, fontWeight: '700', color: C.ink, marginBottom: 6 },
  btn: { borderRadius: 10, alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
});
