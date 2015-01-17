from openslides.utils import rest_api
from rest_framework.reverse import reverse

from .models import Item, Speaker


class SpeakerSerializer(rest_api.serializers.HyperlinkedModelSerializer):
    """
    Serializer for agenda.models.Speaker objects.
    """
    class Meta:
        model = Speaker
        fields = (
            'id',
            'user',
            'begin_time',
            'end_time',
            'weight')


class RelatedItemRelatedField(rest_api.serializers.RelatedField):
    """
    A custom field to use for the `content_object` generic relationship.
    """
    def to_representation(self, value):
        """
        Returns the url to the related object.
        """
        request = self.context.get('request', None)
        assert request is not None, (
            "`%s` requires the request in the serializer"
            " context. Add `context={'request': request}` when instantiating "
            "the serializer." % self.__class__.__name__)
        view_name = '%s-detail' % type(value)._meta.object_name.lower()
        return reverse(view_name, kwargs={'pk': value.pk}, request=request)


class ItemSerializer(rest_api.serializers.HyperlinkedModelSerializer):
    """
    Serializer for agenda.models.Item objects.
    """
    get_title = rest_api.serializers.CharField(read_only=True)
    get_title_supplement = rest_api.serializers.CharField(read_only=True)
    item_no = rest_api.serializers.CharField(read_only=True)
    speaker_set = SpeakerSerializer(many=True, read_only=True)
    tags = rest_api.serializers.HyperlinkedRelatedField(many=True, read_only=True, view_name='tag-detail')
    content_object = RelatedItemRelatedField(read_only=True)

    class Meta:
        model = Item
        exclude = ('content_type', 'object_id')
