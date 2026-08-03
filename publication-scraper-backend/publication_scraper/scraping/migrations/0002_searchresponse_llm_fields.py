from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('scraping', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='searchresponse',
            name='llm_answers',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='searchresponse',
            name='llm_questions',
            field=models.JSONField(default=list),
        ),
    ]
