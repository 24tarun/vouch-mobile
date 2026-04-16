import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { taskCreatorState } from '@/lib/taskCreatorState';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface TabConfig {
  name: string;
  icon: FeatherName;
  title: string;
}

const TABS: TabConfig[] = [
  { name: 'tasks/index',       icon: 'check-circle', title: 'Tasks'       },
  { name: 'friends/index',     icon: 'users',        title: 'Friends'     },
  { name: 'commitments/index', icon: 'target',       title: 'Commitments' },
  { name: 'ledger/index',      icon: 'credit-card',  title: 'Ledger'      },
  { name: 'settings/index',    icon: 'settings',     title: 'Settings'    },
];

function TabIcon({
  icon,
  focused,
}: {
  icon: FeatherName;
  focused: boolean;
}) {
  const tint = focused ? colors.tabActive : colors.tabInactive;
  return (
    <View style={styles.tabItem}>
      <Feather name={icon} size={20} color={tint} />
    </View>
  );
}

export default function AppLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: [
          styles.tabBar,
          // Respect device home indicator on iPhone
          { paddingBottom: insets.bottom, height: 56 + insets.bottom },
        ],
        tabBarBackground: () => <View style={styles.tabBarBg} />,
      }}
    >
      {TABS.map(({ name, icon, title }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused }) => (
              <TabIcon icon={icon} focused={focused} />
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              if (taskCreatorState.isExpanded) {
                taskCreatorState.collapse();
                // Only block navigation if already on the tasks tab (creator's home).
                // For all other tabs, let the navigation proceed so the user lands there.
                if (name === 'tasks/index') {
                  e.preventDefault();
                }
              }
            },
          })}
        />
      ))}

      {/* Hide routes that exist on disk but shouldn't appear in the tab bar */}
      <Tabs.Screen name="index"      options={{ href: null }} />
      <Tabs.Screen name="tasks/[id]" options={{ href: null }} />
      <Tabs.Screen name="commitments/[id]" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.tabBar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarBg: {
    flex: 1,
    backgroundColor: colors.tabBar,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
});
