"""Published content read routes (LAI-0503, ADR-047 K). Read-only, child-scoped, bearer only.

Each list is bounded and each detail returns 404 for anything that is unknown, unpublished,
inactive or not for the child's age band, without saying which. No write routes.
"""

from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from . import content_reads as reads


class _ContentList(ChildScopedAPIView):
    key = ""
    reader = staticmethod(lambda child: [])

    def get(self, request, child_id):
        return Response({self.key: self.reader(self.child)})


class _ContentDetail(ChildScopedAPIView):
    reader = staticmethod(lambda child, key: {})

    def get(self, request, child_id, **kwargs):
        try:
            return Response(self.reader(self.child, *kwargs.values()))
        except reads.ContentNotVisible:
            raise NotFound from None


def _list(name, key, fn):
    return type(name, (_ContentList,), {"key": key, "reader": staticmethod(fn)})


def _detail(name, fn):
    return type(name, (_ContentDetail,), {"reader": staticmethod(fn)})


AdventureListView = _list("AdventureListView", "adventures", reads.adventure_list)
AdventureDetailView = _detail("AdventureDetailView", reads.adventure_detail)
QuestListView = _list("QuestListView", "quests", reads.quest_list)
QuestDetailView = _detail("QuestDetailView", reads.quest_detail)
ItemListView = _list("ItemListView", "items", reads.item_list)
RewardRuleListView = _list("RewardRuleListView", "rewardRules", reads.reward_rule_list)
ObjectiveListView = _list("ObjectiveListView", "learningObjectives", reads.objective_list)
StoryListView = _list("StoryListView", "stories", reads.story_list)
StoryDetailView = _detail("StoryDetailView", reads.story_detail)
NpcListView = _list("NpcListView", "npcs", reads.npc_list)
NpcDetailView = _detail("NpcDetailView", reads.npc_detail)
