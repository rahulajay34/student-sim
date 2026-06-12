Analyze the whole codebase


Below are the few suggestions in an unordered list. You can plan and prioritize them accordingly:
- First, we need to use claude sonnet 4.6 high reasoning instead of minimax.
- Second, if there is any API errors it should properly be reflected on the frontend.
- Check the recent counselling session we have done. The AI was stuck on one line of questioning (around the fee part) again and again. if the counsellor pivots and is nudging towards a different point, you can push back once. but beyond that pivot. dont get stuck on a loop of asking the same question again and again. Also, during this conversation, the AI used quite "um", "uh", "haam", in mostly every turn. We need to reduce it down so that it looks more human like convo.
- Then, we need to deploy it on Supabase. So, you need to design entire archetecture around the same. Make the archetiecture efficient for the mapping of admins and counsellors. Also, we will be handling rounghly 50+ counsellor sessions simultaneously.
- By default if anyone is signing up, be default they should be normal users, not admins.
- The user can only sign up if they with @masaischool.com domain.
- We need to add google authentication as well for siging up and signing in.
- During the counselling, we need more tidy screen. We need to remove the stages of the call from the top left, emotion tag should be removed, Cues should be turned off and remove the cues window as well, remove the dropdown for the AI voice selection, the keyboard icon and by default the message window should be closed. Chat to talk should be remove, we will display the transcript over there.
- Add a feature via which admins can also be able to practice mock for themselves.
- Admins should also be able to create a reusable assignment template and so that they can assign multiple counsellor the same assignment at a time. Like a checklist of counsellors can be selected.
- We will only assign the role of admins from the supabase tables.
- Make the archetecture modular enough so that in the future if we are implementing more features, it should be able to accomodate that as well.

If at any point of time, if you need any clarification or have any improveed suggestions. You can ask me. Also, you can ask me for the google project ids or anything which required for the production or any claude api to put into .env. I'll answer them.

You are a senior software engineer and act as an orchestrator here and deploy your team agentically with different models like opus, haiku, sonnet as you sub-agents depending on the complexity of the task. You can decide your workflow and give a proper goal to individual sub-agents and once they are done, do verify there work as well.

once you are into the implementation phase - do message on this channel on slack https://masaischool.slack.com/archives/C0BADTB0Z4Y tagging all three people - do it very frequent about all the updates or if you want to ask anything.