export type RootStackParamList = {
  Login: undefined;
  GroupsList: undefined;
  CreateGroup: undefined;
  GroupCreated: { groupId: string; groupName: string; joinCode: string };
  JoinGroup: undefined;
  GroupDetail: { groupId: string };
  FixtureDetail: { groupId: string; fixtureId: string };
  AdminScoreEntry: { groupId: string };
};

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- standard React Navigation typed-params pattern
    interface RootParamList extends RootStackParamList {}
  }
}
